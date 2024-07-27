import { Modal, Editor, App, Notice, Setting } from "obsidian";
import { SettingsData } from "../settings"
import { IJiraSearchResults, IJiraWorklog, toDefaultedIssue } from '../interfaces/issueInterfaces'
import { renderTableColumn } from "../rendering/renderTableColumns"
import JiraClient from '../client/jiraClient'
import moment from "moment";
import RC from "../rendering/renderingCommon"

export class CreateWorklogModal extends Modal {
  private editor: Editor;
  private worklogData: IJiraWorklog;
  private onSubmit: (result: IJiraWorklog) => void

  constructor(app: App, editor: Editor, selectedText: string, onSubmit: (result: IJiraWorklog) => void) {
    super(app);
    this.editor = editor;
    this.worklogData = {
      id: undefined, 
      started: moment(moment.now()).format("YYYY-MM-DD"), 
      comment: selectedText, 
      timeSpent: '30m',
      author: undefined,
      create: undefined,
      timeSpentSeconds: undefined,
      updateAuthor: undefined,
      updated: undefined
    };
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl("h2", { text: "Create Jira Worklog" })

    new Setting(contentEl)
        .setName('Comment')
        .addTextArea(textArea => textArea
            .setPlaceholder("Comment")
            .setValue(this.worklogData.comment)
            .onChange(async value => {
                this.worklogData.comment = value
            }))

    new Setting(contentEl)
        .setName('Started')
        .addMomentFormat(text => { text
          .setPlaceholder("Started")
          .setValue(this.worklogData.started)
          .onChange(async value => {
              this.worklogData.started = value
          });
          text.inputEl.type = "date"
        })
    
    new Setting(contentEl)
      .setName('Duration')
      .addText(text => text
        .setPlaceholder("Duration")
        .setValue(this.worklogData.timeSpent)
        .onChange(async value => {
            this.worklogData.timeSpent = value
      }))

    new Setting(contentEl)
      .setName('Search Jira')
      .addText(text => text
        .setPlaceholder("Search String")
        .setValue("")
        .onChange(async value => {
          const issues:IJiraSearchResults = await this.searchJiraIssues(value);
          await this.updateIssuesTable(issuesTable, issues);
      }))

    const issuesDiv = contentEl.createDiv();
    const issuesTable = issuesDiv.createEl('table', { cls: `table is-bordered is-striped is-narrow is-hoverable is-fullwidth ${RC.getTheme()}` })
    issuesDiv.replaceChildren(RC.renderContainer([issuesTable]))

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText("Submit")
        .setCta()
        .onClick(() => {
            this.close()
            this.onSubmit(this.worklogData)
      }))
  }

  async searchJiraIssues(str: string): Promise<IJiraSearchResults> {
    let summary: string = str ? str : ""
    const query: string = "summary ~'" + summary + "' AND project IN (CS, DE, ADEL, IPM) AND (assignee = currentUser() or \"Solution Manager[User Picker (single user)]\" = currentUser() or \"Solution Manager Backup[User Picker (single user)]\" = currentUser()) ORDER BY priority DESC, updated ASC, due ASC, cf[10357] ASC, summary ASC"
    try {
      const result: IJiraSearchResults = await JiraClient.getSearchResults(query);
      return result;
    } catch (error) {
      console.error('Error searching Jira issues:', error);
      new Notice('Error searching Jira issues');
    }
    return null;
  }

  async updateIssuesTable(table: HTMLElement, issues: IJiraSearchResults) {
    table.innerHTML = '';
    this.renderSearchResultsTableBody(table, issues)
    this.worklogData.issueKey = undefined
  }

  async renderSearchResultsTableBody(table: HTMLElement, searchResults: IJiraSearchResults) : Promise<void> {
    const tbody = createEl('tbody', { parent: table })
    for (let issue of searchResults.issues) {
        issue = toDefaultedIssue(issue)
        const row = createEl('tr', { parent: tbody })
        row.onclick = () => {
          table.querySelectorAll('tr').forEach(r => r.removeClass('selected'));
          row.addClass('selected');
          this.worklogData.issueKey = this.getSelectedIssue(table);
          //refresh
          this.open
        };
        const columns = SettingsData.searchColumns
        await renderTableColumn(columns, issue, row)
    }
  }

  getSelectedIssue(table: HTMLElement) {
    const selectedRow = table.querySelector('tr.selected');
    return selectedRow ? selectedRow.children[0].textContent : null;
  }

  async createJiraWorklog(issueKey: string, worklogData: IJiraWorklog) {
    try {
      await JiraClient.createWorklog(issueKey, worklogData);
    } catch (error) {
      console.error('Error creating Jira worklog:', error);
      new Notice('Error creating Jira worklog');
    }
  }

  writeBackToNote(duration: string) {
    const textToInsert = `Logged ${duration} hours`;
    this.editor.replaceSelection(textToInsert);
  }
}
