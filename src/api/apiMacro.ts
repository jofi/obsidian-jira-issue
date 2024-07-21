import { ESprintState, IJiraIssue, IJiraSprint, IJiraWorklog, ISeries } from "../interfaces/issueInterfaces"
import API from "./api"
import moment from "moment"
const ms = require('ms')

function dateTimeToDate(dateTime: string): string {
    if (dateTime.match(/^\d/)) {
        return moment(dateTime).format('YYYY-MM-DD')
    }
    return dateTime;
}

async function getIssuesWithWorklogByDates(projectKeysOrIds: string, startDate: string, endDate: string = 'now()'): Promise<IJiraIssue[]> {
  const searchResults = await API.base.getSearchResults(
    `project IN (${projectKeysOrIds}) AND worklogDate >= ${dateTimeToDate(startDate)} AND worklogDate < ${dateTimeToDate(endDate)}`,
    { limit: 150, fields: ['key'] }
  )
  try {
      return searchResults.issues;
  } catch (error) {
      console.error('Error fetching issues:', error);
      return [];
  }
}

async function getWorklogOfIssueByDates(issueKey: string, startDate: string, endDate: string): Promise<IJiraWorklog[]> {
  const authorWorklogs = await API.base.getWorklogOfIssue(issueKey)

  const startDateMoment: moment.Moment = moment(startDate);
  const endDateMoment: moment.Moment = moment(endDate);

  const filteredWorklogs = authorWorklogs.filter(worklog => {
    const worklogDate = moment(worklog.started);
    return worklogDate.isBetween(startDateMoment, endDateMoment);
  });

  return filteredWorklogs;
}

export async function getActiveSprint(projectKeyOrId: string): Promise<IJiraSprint> {
    const boards = await API.base.getBoards(projectKeyOrId, { limit: 1 })
    if (boards.length > 0) {
        const sprints = await API.base.getSprints(boards[0].id, { state: [ESprintState.ACTIVE], limit: 1 })
        if (sprints.length > 0) {
            return sprints[0]
        }
    }
    return null
}

export async function getActiveSprintName(projectKeyOrId: string): Promise<string> {
    const sprint = await API.macro.getActiveSprint(projectKeyOrId)
    return sprint ? sprint.name : ''
}

export async function getWorkLogBySprint(projectKeyOrId: string, sprint: IJiraSprint): Promise<IJiraWorklog[]> {
    return await getWorkLogByDates(projectKeyOrId, sprint.startDate, sprint.endDate)
}

export async function getWorkLogBySprintId(projectKeyOrId: string, sprintId: number): Promise<IJiraWorklog[]> {
    const sprint = await API.base.getSprint(sprintId)
    return await getWorkLogByDates(projectKeyOrId, sprint.startDate, sprint.endDate)
}

export async function getWorkLogByDates(projectKeysOrIds: string, startDate: string, endDate: string = 'now()'): Promise<IJiraWorklog[]> {
  const issues = await getIssuesWithWorklogByDates(projectKeysOrIds, startDate, endDate);
  const issueKeys = issues.map(issue => {return issue.key});

  let allWorklogs: IJiraWorklog[] = [];

  for (const issueKey of issueKeys) {
    const worklogs = await getWorklogOfIssueByDates(issueKey,startDate, endDate);
    allWorklogs = allWorklogs.concat(worklogs);
  }

  return allWorklogs;
}

export async function getWorkLogByDatesOld(projectKeyOrId: string, startDate: string, endDate: string = 'now()'): Promise<IJiraWorklog[]> {
    const searchResults = await API.base.getSearchResults(
        `project = "${projectKeyOrId}" AND worklogDate > ${dateTimeToDate(startDate)} AND worklogDate < ${dateTimeToDate(endDate)}`,
        { limit: 50, fields: ['worklog'] }
    )
    let worklogs: IJiraWorklog[] = []
    for (const issue of searchResults.issues) {
        if (issue.fields.worklog && issue.fields.worklog.worklogs) {
            issue.fields.worklog.worklogs.forEach(worklog => worklog.issueKey = issue.key)
            worklogs = worklogs.concat(issue.fields.worklog.worklogs)
        }
    }
    return worklogs
}

export async function getWorkLogSeriesByUser(projectKeyOrId: string, startDate: string, endDate: string = 'now()'): Promise<ISeries> {
    const worklogs = await API.macro.getWorkLogByDates(projectKeyOrId, startDate, endDate)
    const series: ISeries = {}
    for (const worklog of worklogs) {
        const author = worklog.author.emailAddress
        if (!(author in series)) {
            series[author] = 0
        }
        series[author] += worklog.timeSpent.split(' ').map(x => ms(x)).reduce((x, y) => x + y)
    }
    return series
}

export async function getVelocity(projectKeyOrId: string, sprintId: number, storyPointFieldName: string = 'aggregatetimeoriginalestimate') {
    const searchResults = await API.base.getSearchResults(
        `project = "${projectKeyOrId}" AND sprint = ${sprintId} AND resolution = Done`,
        { limit: 50, fields: [storyPointFieldName] }
    )
    let velocity = 0
    for (const issue of searchResults.issues) {
        velocity += issue.fields[storyPointFieldName]
    }
    return velocity
}
