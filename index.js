// Import necessary modules
const WebSocket = require('ws');
const axios = require('axios');
const fs = require('fs');
const readline = require('readline'); // For user input in the console
require('dotenv').config(); // Load environment variables from .env file

console.log('Starting the application...');

// Buffer to store PCM data (the raw audio from the call)
let pcmBuffer = Buffer.alloc(0);

// Retry logic variables (used for reconnecting the WebSocket in case it fails)
let retryCount = 0;
const maxRetries = 5; // You can increase this to allow more reconnection attempts
const retryDelay = 5000; // Delay between retries (in milliseconds)

// Function to create a unique filename for saving the audio file
function getUniqueFilename() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-'); // e.g., 2024-09-29T13-45-30
  return `audio_${timestamp}.wav`; // File will be saved as 'audio_<timestamp>.wav'
}

// Function to save the PCM data as a WAV file
function saveWAVFile(pcmBuffer, filename) {
  console.log(`Saving WAV file as ${filename}...`);
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
  fs.writeFileSync(filename, Buffer.concat([header, pcmBuffer]));
  console.log(`WAV file saved as ${filename}`);
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
async function sayMessage(controlUrl, message) {
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
      assistantId: '7cf23a21-f4ca-4695-9907-18b135fc2f2f',  // Previous Assistant ID
      customer: {
        number: '+16803565600'  // Previous Customer Phone Number
      },
      phoneNumberId: 'ed9c50a3-ea74-4d45-b8b7-b8b52c8576a6'  // Previous Phone Number ID
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

    // Wait for the user to press ENTER before starting the WebSocket
    await pauseForUserInput('Press ENTER once the call is answered to start receiving audio...');

    // Prompt for a message that the assistant will say during the call
    const messageToSay = await pauseForUserInput('Enter the message for the assistant to say: ');
    await sayMessage(monitor.controlUrl, messageToSay);  // Inject the message into the call

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
    if (pcmBuffer.length > 0) {
      const filename = getUniqueFilename();
      saveWAVFile(pcmBuffer, filename);  // Save the audio as a WAV file
    }
    attemptReconnect(listenUrl);  // Try to reconnect if needed
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    ws.close();  // Close WebSocket on error
  });
}

// Function to attempt reconnection if the WebSocket connection drops
function attemptReconnect(listenUrl) {
  if (retryCount < maxRetries) {
    console.log(`Reconnecting... Attempt ${retryCount + 1} of ${maxRetries}`);
    retryCount++;
    setTimeout(() => connectWebSocket(listenUrl), retryDelay);  // Reconnect after a delay
  } else {
    console.error('Max retries reached. Unable to reconnect.');
  }
}

// Start the call process
initiateCall();