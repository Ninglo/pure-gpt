import * as vscode from 'vscode';

type GPTMode = 'gpt-3.5-turbo' | 'gpt-4' | 'gpt-4-turbo';
const GPT_PARTICIPANT_ID = 'pure-gpt.gpt';

export async function activate(context: vscode.ExtensionContext) {
    // get configuration
    const config = vscode.workspace.getConfiguration(GPT_PARTICIPANT_ID);
    const type = config.get<GPTMode>('type', 'gpt-3.5-turbo');
    const maxHistoryLength = config.get<number>('max-history-length', 3);
    const prompts = config.get<string[]>('prompts', []);

    const promptEntries = prompts.map((prompt, i) => {
        const name = `prompt${i + 1}`;
        vscode.commands.executeCommand('setContext', `${GPT_PARTICIPANT_ID}.${name}`, true);
        return [name, prompt];
    });
    const promptsMap = Object.fromEntries(promptEntries);

    const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<vscode.ChatResult> => {
        // slice the end maxHistoryLength messages
        const history = context.history.slice(-maxHistoryLength * 2).map(historyToChatMessage);
        const requestCommand = request.command ?? '';
        const prompt = promptsMap[requestCommand] ?? '';
        try {
            const models = await vscode.lm.selectChatModels({ family: type });
            console.log(models);
            const model = models[0];
            if (model) {
                const messages = prompt ? [
                    ...history,
                    vscode.LanguageModelChatMessage.User(prompt), vscode.LanguageModelChatMessage.User(request.prompt)
                ] : [
                    ...history,
                    vscode.LanguageModelChatMessage.User(request.prompt)
                ];

                const chatResponse = await model.sendRequest(messages, {}, token);
                for await (const fragment of chatResponse.text) {
                    // Process the output from the language model
                    stream.markdown(fragment);
                }
            }
        } catch (err) {
            handleError(err, stream);
        }

        return { metadata: { command: requestCommand } };
    };

    const gpt = vscode.chat.createChatParticipant(GPT_PARTICIPANT_ID, handler);
    gpt.iconPath = vscode.Uri.joinPath(context.extensionUri, 'logo.jpg');

    context.subscriptions.push(
        gpt,
    );
}

function historyToChatMessage(history: vscode.ChatRequestTurn | vscode.ChatResponseTurn): vscode.LanguageModelChatMessage {
    if (history instanceof vscode.ChatRequestTurn) {
        return vscode.LanguageModelChatMessage.User(history.prompt);
    } else {
        return vscode.LanguageModelChatMessage.Assistant(history.response.map(fragment => {
            if (fragment instanceof vscode.MarkdownString) {
                return fragment.value;
            } else {
                return '';
            }
        }).join('\n'));
    }

}

function handleError(err: any, stream: vscode.ChatResponseStream): void {
    // making the chat request might fail because
    // - model does not exist
    // - user consent not given
    // - quote limits exceeded
    if (err instanceof vscode.LanguageModelError) {
        console.log(err.message, err.code, err.cause);
        stream.markdown(err.message);
    } else {
        throw err;
    }
}

export function deactivate() { }
