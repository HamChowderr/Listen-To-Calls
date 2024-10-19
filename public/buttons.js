const buttonsConfig = [
    { text: "Send Greeting", message: "Hello! How can I assist you today?" },
    { text: "Send Goodbye", message: "Goodbye!" },
    { text: "Ask Question", message: "What is your question?" },
    { text: "Provide Information", message: "Here is the information you requested." },
    { text: "Check Status", message: "Can you provide more details?" },
    { text: "Offer Help", message: "How can I help you further?" },
    { text: "Confirm Action", message: "Action confirmed." },
    { text: "Reject Action", message: "Action rejected." },
    { text: "Thank You", message: "Thank you for your patience!" }
];

// Export the buttons configuration so it can be imported in the HTML page
if (typeof module !== "undefined") {
    module.exports = buttonsConfig;
}