// Import necessary modules
const WebSocket = require('ws');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path'); // To handle file paths
const readline = require('readline'); // For user input in the console
require('dotenv').config(); // Load environment variables from .env file

// Initialize Express app
const app = express();
const port = 3000; // Port for the web server

// Middleware to serve static files and parse JSON
app.use(express.static('public'));  // Ensure static files (index.html, buttons.js) are served from 'public' directory
app.use(bodyParser.json());

console.log('Starting the application...');

// Buffer to store PCM data (the raw audio from the call)
let pcmBuffer = Buffer.alloc(0);

// Retry logic variables
let retryCount = 0;
const maxRetries = 5; // Max retries
const retryDelay = 5000; // Retry delay

// Global variable to store the control URL and the callAnswered status
let controlUrl = '';  // Initially empty, will be updated by initiateCall()
let callAnswered = false;

// Ensure that the audio directory exists
const audioDir = path.join(__dirname, 'audio_files');
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir); // Create the folder if it doesn't exist
  console.log(`Created directory: ${audioDir}`);
}

// Function to format the current date and time in `MM-DD-YY--HH:MMAM/PM` format
function formatDateTime() {
  const now = new Date();
  const options = {
    year: '2-digit', month: '2-digit', day: '2-digit',
    hour: 'numeric', minute: '2-digit', hour12: true
  };
  
  // Replace slashes (/) with dashes (-) and space with double dash (--), ensuring filename-safe format
  return now.toLocaleString('en-US', options).replace(/\//g, '-').replace(/,/, '').replace(' ', '--');
}

// Function to create a simple time-stamped filename
function getUniqueFilename() {
  const formattedDateTime = formatDateTime(); // Example: 10-18-24--9:30PM
  return `audio_${formattedDateTime}.wav`;
}

// Function to save the PCM data as a WAV file
function saveWAVFile(pcmBuffer) {
  const filename = getUniqueFilename();  // Get the formatted filename
  const filepath = path.join(audioDir, filename);  // Save the file in the `audio_files` directory
  console.log(`Saving WAV file as ${filepath}...`);

  const sampleRate = 16000; // Sample rate for the audio (16kHz is common for voice)
  const numChannels = 2; // Stereo audio (change to 1 for mono)
  const bitsPerSample = 16; // 16-bit audio (standard for good voice quality)

  const header = Buffer.alloc(44); // WAV file header (always 44 bytes)

  // Construct the WAV file header
  header.write('RIFF', 0); // Chunk ID
  header.writeUInt32LE(36 + pcmBuffer.length, 4); // Chunk size
  header.write('WAVE', 8); // Format
  header.write('fmt ', 12); // Subchunk1 ID
  header.writeUInt32LE(16, 16); // Subchunk1 size
  header.writeUInt16LE(1, 20); // Audio format (PCM = 1)
  header.writeUInt16LE(numChannels, 22); // Number of channels (1 = mono, 2 = stereo)
  header.writeUInt32LE(sampleRate, 24); // Sample rate (e.g., 16000)
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  header.writeUInt32LE(byteRate, 28); // Byte rate
  const blockAlign = numChannels * bitsPerSample / 8;
  header.writeUInt16LE(blockAlign, 32); // Block align
  header.writeUInt16LE(bitsPerSample, 34); // Bits per sample
  header.write('data', 36); // Subchunk2 ID
  header.writeUInt32LE(pcmBuffer.length, 40); // Subchunk2 size

  // Write the WAV header and data to a file
  fs.writeFileSync(filepath, Buffer.concat([header, pcmBuffer]));
  console.log(`WAV file saved as ${filepath}`);
}

// Function to wait for user input (press ENTER to proceed)
function pauseForUserInput(promptText) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Function to inject a message into the live call via controlUrl
async function sayMessage(message) {
  try {
    console.log('Injecting message into the call...');
    await axios.post(controlUrl, {
      type: 'say',  // Command to inject speech
      message: message  // The message that will be spoken during the call
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log(`Assistant said: "${message}"`);
  } catch (error) {
    console.error('Error injecting message:', error.response ? error.response.data : error.message);
  }
}

// Function to initiate the call (API call to VAPI)
async function initiateCall() {
  try {
    console.log('Starting the call initiation process...');
    // Make an API request to initiate a call and retrieve the listenUrl and controlUrl
    const response = await axios.post('https://api.vapi.ai/call/phone', {
      assistantId: '7cf23a21-f4ca-4695-9907-18b135fc2f2f',  // Assistant ID
      customer: {
        number: '+16803565600'  // Customer Phone Number
      },
      phoneNumberId: 'ed9c50a3-ea74-4d45-b8b7-b8b52c8576a6'  // Phone Number ID
    }, {
      headers: {
        'authorization': `Bearer ${process.env.VAPI_API_KEY}`,  // API key from .env file
        'content-type': 'application/json'
      }
    });

    // Extract listenUrl and controlUrl from the response
    const { monitor } = response.data;
    console.log('Listen URL:', monitor.listenUrl);
    console.log('Control URL:', monitor.controlUrl);

    // Set the global controlUrl so it can be used in /send-message route
    controlUrl = monitor.controlUrl;

    // Wait for the user to press ENTER before starting the WebSocket
    await pauseForUserInput('Press ENTER once the call is answered to start receiving audio...');

    // Start the WebSocket connection to receive PCM audio data
    connectWebSocket(monitor.listenUrl);

  } catch (error) {
    console.error('Error initiating call:', error.response ? error.response.data : error.message);
  }
}

// Function to connect to WebSocket and handle incoming PCM data
function connectWebSocket(listenUrl) {
  console.log('Attempting to connect to WebSocket:', listenUrl);

  const ws = new WebSocket(listenUrl);

  ws.on('open', () => {
    console.log('WebSocket connection established');
    retryCount = 0;  // Reset retry count on successful connection
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      pcmBuffer = Buffer.concat([pcmBuffer, data]);  // Append PCM data to buffer
      console.log(`Received PCM data, buffer size: ${pcmBuffer.length}`);
    } else {
      console.log('Received message:', data.toString());  // Non-binary messages (not PCM data)
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
    // Ensure that a WAV file is created when the call ends
    if (pcmBuffer.length > 0) {
      saveWAVFile(pcmBuffer);  // Save the audio as a WAV file
    } else {
      console.log('No PCM data received, no file saved.');
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    ws.close();  // Close WebSocket on error
  });
}

// Handle POST request to send a message to the assistant
app.post('/send-message', async (req, res) => {
    const message = req.body.message;

    // Ensure controlUrl is set before attempting to send the message
    if (!controlUrl) {
        return res.status(500).json({ success: false, error: 'Control URL not set. Please initiate the call first.' });
    }

    try {
        // Send the message to the assistant via the control URL
        await sayMessage(message);

        // Send a response back to the frontend
        res.json({ success: true, message: "Message sent to assistant: " + message });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ success: false, error: 'Failed to send message.' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

// Start the call process
initiateCall();