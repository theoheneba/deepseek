import * as vscode from 'vscode';
import axios, { AxiosError } from 'axios';

// Create an output channel for logging
const outputChannel = vscode.window.createOutputChannel('DeepSeek');

// Log messages
function log(message: string) {
  outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
}

// Activate the extension
export function activate(context: vscode.ExtensionContext) {
  // Register command to set API key
  context.subscriptions.push(
    vscode.commands.registerCommand('deepseek.setApiKey', async () => {
      const apiKey = await vscode.window.showInputBox({
        prompt: 'Enter your DeepSeek API Key',
        password: true, // Hide input
      });

      if (apiKey) {
        await context.secrets.store('deepseek.apiKey', apiKey);
        vscode.window.showInformationMessage('DeepSeek API Key saved successfully!');
        log('API key saved successfully.');
      } else {
        vscode.window.showErrorMessage('No API key provided.');
        log('No API key provided by the user.');
      }
    })
  );

  // Register command to suggest code
  context.subscriptions.push(
    vscode.commands.registerCommand('deepseek.suggestCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor!');
        log('No active editor found.');
        return;
      }

      const selection = editor.selection.isEmpty
        ? editor.document.getText()
        : editor.document.getText(editor.selection);

      try {
        log(`Requesting code suggestion for: ${selection}`);
        const suggestion = await queryDeepSeekWithRetry(
          `Improve or complete this code: ${selection}`,
          context
        );

        await editor.edit((editBuilder) => {
          editBuilder.insert(editor.selection.active, suggestion);
        });
        log('Code suggestion applied successfully.');
      } catch (error) {
        handleError(error);
      }
    })
  );
}

// Deactivate the extension
export function deactivate() {}

// Helper function to call DeepSeek API with retry logic
async function queryDeepSeekWithRetry(prompt: string, context: vscode.ExtensionContext, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await queryDeepSeek(prompt, context);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 429 && i < retries - 1) {
        // Wait before retrying (exponential backoff)
        const waitTime = Math.pow(2, i) * 1000; // 1s, 2s, 4s, etc.
        log(`Rate limit hit. Retrying in ${waitTime / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      } else {
        throw error; // Re-throw if not a retryable error
      }
    }
  }
}

// Helper function to call DeepSeek API
async function queryDeepSeek(prompt: string, context: vscode.ExtensionContext) {
  const apiKey = await context.secrets.get('deepseek.apiKey');
  if (!apiKey) {
    log('API key not found. Prompting user to configure it.');
    throw new Error('API key not found. Configure it first using the "DeepSeek: Set API Key" command.');
  }

  log(`Sending request to DeepSeek API with prompt: ${prompt}`);
  const response = await axios.post(
    'https://api.deepseek.com/v1/chat/completions', // Replace with actual API endpoint
    {
      model: 'deepseek-coder',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000, // 10-second timeout
    }
  );

  if (!response.data.choices || !response.data.choices[0]?.message?.content) {
    log('Invalid response from DeepSeek API.');
    throw new Error('Invalid response from DeepSeek API');
  }

  log('Received valid response from DeepSeek API.');
  return response.data.choices[0].message.content;
}

// Centralized error handling
function handleError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;

    if (axiosError.response) {
      // API returned an error response (e.g., rate limit, invalid API key)
      const status = axiosError.response.status;
      const data = axiosError.response.data;

      if (status === 429) {
        log('Rate limit exceeded.');
        vscode.window.showErrorMessage('DeepSeek API: Rate limit exceeded. Please try again later.');
      } else if (status === 401) {
        log('Invalid API key.');
        vscode.window.showErrorMessage('DeepSeek API: Invalid API key. Please configure it using the "DeepSeek: Set API Key" command.');
      } else {
        log(`API Error: ${status} - ${JSON.stringify(data)}`);
        vscode.window.showErrorMessage(`DeepSeek API Error: ${status} - ${JSON.stringify(data)}`);
      }
    } else if (axiosError.request) {
      // No response received (network issue)
      log('Network error.');
      vscode.window.showErrorMessage('DeepSeek API: Network error. Please check your internet connection.');
    } else {
      // Other Axios errors
      log(`Axios Error: ${axiosError.message}`);
      vscode.window.showErrorMessage(`DeepSeek API Error: ${axiosError.message}`);
    }
  } else if (error instanceof Error) {
    // Generic errors (e.g., invalid API key, invalid response)
    log(`Error: ${error.message}`);
    vscode.window.showErrorMessage(`DeepSeek Error: ${error.message}`);
  } else {
    // Unknown errors
    log('An unknown error occurred.');
    vscode.window.showErrorMessage('An unknown error occurred while calling DeepSeek API.');
  }
}