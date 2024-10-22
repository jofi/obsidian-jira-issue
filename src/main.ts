import { App, Editor, MarkdownView, Notice, Plugin } from 'obsidian'
import { JiraIssueSettingTab } from './settings'
import JiraClient from './client/jiraClient'
import ObjectsCache from './objectsCache'
import { ColumnsSuggest } from './suggestions/columnsSuggest'
import { CountFenceRenderer } from './rendering/countFenceRenderer'
import { InlineIssueRenderer } from './rendering/inlineIssueRenderer'
import { IssueFenceRenderer } from './rendering/issueFenceRenderer'
import { SearchFenceRenderer } from './rendering/searchFenceRenderer'
import { SearchWizardModal } from './modals/searchWizardModal'
import { CreateWorklogModal } from './modals/createWorklogModal'
import { ViewPluginManager } from './rendering/inlineIssueViewPlugin'
import { QuerySuggest } from './suggestions/querySuggest'
import { setupIcons } from './icons/icons'
import API from './api/api'
import { IJiraWorklog } from './interfaces/issueInterfaces'
import { IJiraIssueAccountSettings } from './interfaces/settingsInterfaces'
import { SettingsData } from "./settings"

// TODO: text on mobile and implement horizontal scrolling

export let ObsidianApp: App = null

export default class JiraIssuePlugin extends Plugin {
    private _settingTab: JiraIssueSettingTab
    private _columnsSuggest: ColumnsSuggest
    private _querySuggest: QuerySuggest
    private _inlineIssueViewPlugin: ViewPluginManager
    public api = API

    async onload() {
        ObsidianApp = this.app
        this.registerAPI()
        this._settingTab = new JiraIssueSettingTab(this.app, this)
        await this._settingTab.loadSettings()
        this.addSettingTab(this._settingTab)
        JiraClient.updateCustomFieldsCache()
        // Load icons
        setupIcons()
        // Fence rendering
        this.registerMarkdownCodeBlockProcessor('jira-issue', IssueFenceRenderer)
        this.registerMarkdownCodeBlockProcessor('jira-search', SearchFenceRenderer)
        this.registerMarkdownCodeBlockProcessor('jira-count', CountFenceRenderer)
        // Suggestion menu for columns inside jira-search fence
        this.app.workspace.onLayoutReady(() => {
            this._columnsSuggest = new ColumnsSuggest(this.app)
            this.registerEditorSuggest(this._columnsSuggest)
        })
        // Suggestion menu for query inside jira-search fence
        this.app.workspace.onLayoutReady(() => {
            this._querySuggest = new QuerySuggest(this.app)
            this.registerEditorSuggest(this._querySuggest)
        })
        // Reading mode inline issue rendering
        this.registerMarkdownPostProcessor(InlineIssueRenderer)
        // Live preview inline issue rendering
        this._inlineIssueViewPlugin = new ViewPluginManager()
        this._inlineIssueViewPlugin.getViewPlugins().forEach(vp => this.registerEditorExtension(vp))

        // Settings refresh
        this._settingTab.onChange(() => {
            ObjectsCache.clear()
            JiraClient.updateCustomFieldsCache()
            this._inlineIssueViewPlugin.update()
        })

        // Commands
        this.addCommand({
            id: 'obsidian-jira-issue-clear-cache',
            name: 'Clear cache',
            callback: () => {
                ObjectsCache.clear()
                JiraClient.updateCustomFieldsCache()
                new Notice('JiraIssue: Cache cleaned')
            }
        })
        this.addCommand({
            id: 'obsidian-jira-issue-template-fence',
            name: 'Insert issue template',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                editor.replaceRange('```jira-issue\n\n```', editor.getCursor())
            }
        })
        this.addCommand({
            id: 'obsidian-jira-search-wizard-fence',
            name: 'Search wizard',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                new SearchWizardModal(this.app, (result) => {
                    editor.replaceRange(result, editor.getCursor())
                }).open()
            }
        })
        this.addCommand({
            id: 'obsidian-jira-count-template-fence',
            name: 'Insert count template',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                editor.replaceRange('```jira-count\n\n```', editor.getCursor())
            }
        })
        this.addCommand({
          id: 'open-worklog-dialog',
          name: 'Open Worklog Dialog',
          editorCallback: (editor: Editor) => {
            const selectedText = editor.getSelection();
            const modal = new CreateWorklogModal(this.app, editor, selectedText, async (result:IJiraWorklog) => {
              if (result) {
                if (result.issueKey) {
                  result.started = result.started+"T12:34:00.000+0000"
                  const jiraAccountSettings = SettingsData.accounts[0];

                  // Call the function to submit the worklog to Lambda
                  try {
                    const lambdaResponse = await callLambdaToSubmitWorklog(result, jiraAccountSettings);
                    console.log("Worklog submitted successfully:", lambdaResponse);
                    const wltext = generateWorklogMarkdown(result.issueKey, lambdaResponse.jiraResponse.id, result.timeSpent, result.comment, jiraAccountSettings.host)
                    editor.replaceSelection(wltext);
                  } catch (error) {
                    console.error("Failed to submit worklog:", error);
                    // Handle any UI updates or error notifications here
                    //var wl = await JiraClient.createWorklog(result.issueKey, result)
                    var str = `- ${result.timeSpent} - JIRA:${result.issueKey}:\n` +
                    "```text\n" +
                    result.comment + "\n" +
                    "```\n";
                    editor.replaceSelection(str)
                    //"```sh\n" +
                    
                    var jcli_str: string = "multiline_string=$(cat <<EOF\n" +
                    result.comment + "\n" +
                    "EOF\n" + 
                    ")\n\n" +
                    `jira-cli issue worklog add "${result.issueKey}" "${result.timeSpent}" --comment \"$multiline_string\" --started "${result.started}" --no-input\n`;
                    //"```\n";
                    copyToClipboard(jcli_str)
                  }
                } else {
                  var str = `- ${result.timeSpent} - NOJIRA:\n` + 
                  "```text\n" +
                  result.comment + "\n" +
                  "```\n";
                  editor.replaceSelection(str)
                }
              } else {
                new Notice('JiraIssue: No worklog was created!!!')
              }
            }).open();
          }
        })
    }
    
    onunload() {
        this._settingTab = null
        this._columnsSuggest = null
        this._inlineIssueViewPlugin = null
    }

    private registerAPI() {
        // @ts-ignore
        window.$ji = API
    }
}

async function callLambdaToSubmitWorklog(result: IJiraWorklog, jiraAccountSettings: IJiraIssueAccountSettings) {
  // Hardcode your Lambda's API Gateway URL
  const lambdaUrl = "https://w1gamse1e1.execute-api.eu-central-1.amazonaws.com/dev/submit-worklog";
  //const lambdaUrl = "http://localhost:3000/dev/submit-worklog"

  // Prepare the payload according to the Lambda contract
  const lambdaPayload = {
    worklog: result,
    jiraUrl: jiraAccountSettings.host,   // Use the Jira URL from the settings
    email: jiraAccountSettings.username, // Assuming 'username' holds the email
    apiToken: jiraAccountSettings.password  // Use the token from the settings
  };

  console.log("LambdaPayload: " + JSON.stringify(lambdaPayload))

  // Make the HTTP request to the Lambda
  try {
    const response = await fetch(lambdaUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(lambdaPayload),
    });

    if (response.ok) {
      const data = await response.json();
      console.log("Lambda response:", data);
      // Handle success (maybe show a success notification in Obsidian)
      return data;
    } else {
      console.error("Failed to submit worklog:", response.statusText);
      // Handle error (show an error message to the user)
      throw new Error(`Failed to submit worklog: ${response.statusText}`);
    }
  } catch (error) {
    console.error("Error while submitting to Lambda:", error);
    // Handle network or other errors
    throw error;
  }
}

function generateWorklogMarkdown(issueId: string, worklogId: string, duration: string, comment: string, jiraUrl: string): string {
  const timestamp = new Date().toISOString(); // Current timestamp
  const worklogLink = `${jiraUrl}/browse/${issueId}?focusedWorklogId=${worklogId}`; // Link directly to the worklog
  
  return `
#### ✅ Work ${duration}

- **Jira:** JIRA:${issueId}
- **Worklog:** [View](${worklogLink})
- **Timestamp:** ${timestamp}
- **Comment:**
\`\`\`
${comment}
\`\`\`  

`;

//   return `
// #### Worklog Submitted
// - **Duration:** ${duration}
// - **Comment:** ${comment}
// - **Worklog:** JIRA:${issueId} [View Worklog](${worklogLink})
// - **Timestamp:** ${timestamp}

// ✅ Worklog successfully submitted via Lambda.
//   `;
}

// Define the copyToClipboard function inside the plugin file
function copyToClipboard(text: string) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';  // Avoid scrolling to bottom
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
      document.execCommand('copy');
  } catch (err) {
      console.error('Failed to copy text: ', err);
  }
  document.body.removeChild(textarea);
}
