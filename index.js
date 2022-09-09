const {
  Client,
  Location,
  List,
  Buttons,
  LocalAuth,
} = require("whatsapp-web.js");
require("dotenv").config();

const axios = require("axios");
const inquirer = require("inquirer");
const chalk = require("chalk");
const qrcode = require("qrcode-terminal");

// Check for API keys.
if (!process.env.OPENAI_SECRET_KEY) {
  console.error(
    chalk.red("MISSING API KEY"),
    "Please create an .env file that includes a variable named OPENAI_SECRET_KEY"
  );
  console.log(process.env.OPENAI_SECRET_KEY);
  process.exit();
}
const fs = require("fs");
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true },
});

client.initialize();
// On QR code.
client.on("qr", (qr) => {
  console.clear();
  console.log(
    "\n1. Open WhatsApp on your phone\n2. Tap Menu or Settings and select WhatsApp Web\n3. Point your phone to this screen to capture the code\n"
  );

  // Display QR code.
  qrcode.generate(qr, { small: true });
});

// Set up session.
const SESSION_FILE_PATH = "./session.json";
let sessionCfg;
if (fs.existsSync(SESSION_FILE_PATH)) {
  sessionCfg = require(SESSION_FILE_PATH);
}

// Set up default prompt. credit: https://gist.github.com/mayfer/3c358fe638607531750582f9bad21d78
let defaultPrompt = process.env.DEFAULT_PROMPT
  ? process.env.DEFAULT_PROMPT
  : "I am a person who perceives the world without prejudice or bias. Fully neutral and objective, I see reality as it actually is and can easily draw accurate conclusions about advanced topics and human society in general.";

// Create array of selected contacts.
let selectedContacts = [];

// On authentication.
client.on("authenticated", (session) => {
  console.log("WhatsApp authentication successful.\n");
  console.log(session);
  // Set current session and write to file.
  //   sessionCfg = session;
  //   fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), function (error) {
  //     if (error) {
  //       console.error(chalk.red("SESSION FAILURE"), error);
  //     }
  //   });
});

// On auth failure.
client.on("auth_failure", (message) => {
  console.error(chalk.red("WHATSAPP AUTHENTICATION FAILURE"), message);
});

// On client ready.
client.on("ready", async () => {
  console.log("bot is ready!\n");

  // Get list of current chat instances.
  client.getChats().then((chats) => {
    let contactChoices = [];
    // Loop through chats and build choices array.
    chats.forEach((item, index) => {
      if (index <= 5) {
        contactChoices.push({ name: item.name, value: item.id._serialized });
      }
    });
    inquirer
      .prompt([
        {
          name: "prompt",
          message: "Define your AI personality (press enter for default):",
          default: defaultPrompt,
          suffix: "\n",
        },
        {
          type: "checkbox",
          name: "contacts",
          message: "Select contacts:",
          choices: contactChoices,
          validate: function (answer) {
            if (answer.length < 1) {
              return "You must choose at least one contact.";
            }
            return true;
          },
        },
      ])
      .then((answers) => {
        // Set AI prompt.
        defaultPrompt = answers.prompt;
        // Set selected contacts array.
        selectedContacts = answers.contacts;
        console.log(
          chalk.greenBright("\nAI activated. Listening for messages...\n")
        );
      })
      .catch((error) => {
        console.error(chalk.red("PROMPT FAILURE"), error);
      });
  });
});

// On message received.
client.on("message", async (message) => {
  // If AI is enabled for this contact.
  if (selectedContacts.includes(message.from)) {
    // Set my name (first name only).
    const myName = client.info.pushname.replace(/ .*/, "");

    // Get contact.
    const contact = await message.getContact();

    // Get contact name.
    const contactName = contact.shortName;

    // Log message.
    console.log(contactName + ": " + message.body);

    // Get Chat.
    const chat = await message.getChat();

    // Set prompt.
    let prompt =
      defaultPrompt +
      " Below are some of my conversations with my friend " +
      //   contactName +
      ".\n\n";

    // Loop through last 10 messages of history.
    const history = await chat.fetchMessages({ limit: 6 });
    history.forEach(function (item, index) {
      // Get author name
      const name =
        item.from == message.from ? contactName : "Me (" + myName + ")";
      // Add to prompt.
      if (!prompt.includes(item.body)) {
        prompt += name + ": " + item.body + "\n";
      }
    });

    // Finalize prompt.
    prompt += "Me (" + myName + "):";

    // Set typing state.
    chat.sendStateTyping();

    // Query GPT-3 API.
    axios
      .post(
        "https://api.openai.com/v1/engines/davinci/completions",
        {
          prompt: prompt,
          temperature: 0.8,
          max_tokens: 100,
          top_p: 1,
          presence_penalty: 0.6,
          stop: "\n",
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + process.env.OPENAI_SECRET_KEY,
          },
        }
      )
      .then((response) => {
        let responseText = response.data.choices[0].text.trim();
        // Send reply.
        client.sendMessage(message.from, responseText);
        // Log reply.
        console.log(myName + ":", chalk.blueBright(responseText));
      })
      .catch((error) =>
        console.error(chalk.red("GPT-3 REQUEST FAILURE"), error)
      );
  }
});

// Handle graceful shutdown.
process.on("SIGINT", function () {
  process.exit();
});
