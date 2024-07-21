import { IJiraWorklog } from "../interfaces/issueInterfaces"
import API from "./api"
import moment from 'moment';
const ms = require('ms')

async function getIssuesOfProjectsWithWorklogsBetweenDates(projectKeysOrIds: string, startDate: moment.Moment, endDate: moment.Moment): Promise<string[]> {
  const searchResults = await API.base.getSearchResults(
    `project IN (${projectKeysOrIds}) AND worklogDate > ${startDate.format('YYYY-MM-DD')} AND worklogDate < ${endDate.format('YYYY-MM-DD')}`,
    { limit: 150, fields: ['key'] }
  )

  try {
      return searchResults.issues.map((issue: any) => issue.key);
  } catch (error) {
      console.error('Error fetching issues:', error);
      return [];
  }
}

async function getWorklogsOfIssueByAuthor(issueKey: string, authorEmail: string): Promise<IJiraWorklog[]> {
    const allWorklogs = await API.base.getWorklogOfIssue(issueKey)

    const filteredWorklogs = allWorklogs.filter(worklog => {
      return worklog.author.emailAddress == authorEmail;
    });

    return filteredWorklogs;
}

async function getWorklogsOfIssueByAuthorAndDates(issueKey: string, authorEmail: string, startDate: moment.Moment, endDate: moment.Moment): Promise<IJiraWorklog[]> {
  const authorWorklogs = await getWorklogsOfIssueByAuthor(issueKey, authorEmail)

  const filteredWorklogs = authorWorklogs.filter(worklog => {
    const worklogDate = moment(worklog.started);
    return worklogDate.isBetween(startDate, endDate, undefined, "[]");
  });

  return filteredWorklogs;
}

  async function getWorklogsOfAuthorAndDates(projectKeysOrIds: string, authorEmail: string, startDate: moment.Moment, endDate: moment.Moment): Promise<IJiraWorklog[]> {
  const issueKeys = await getIssuesOfProjectsWithWorklogsBetweenDates(projectKeysOrIds, startDate, endDate);
  let allWorklogs: IJiraWorklog[] = [];

  for (const issueKey of issueKeys) {
    const worklogs = await getWorklogsOfIssueByAuthorAndDates(issueKey, authorEmail, startDate, endDate);
    allWorklogs = allWorklogs.concat(worklogs);
  }

  return allWorklogs;
}
