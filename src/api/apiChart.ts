import moment from "moment"
import { IMultiSeries, ISeries } from "../interfaces/issueInterfaces"
import API from "./api"
const ms = require('ms')

const CHART_WIDTH = '800px'

enum EChartFormat {
    HOURS = 'Hours',
    DAYS = 'Days',
    MANDAYS = "Mandays",
    PERCENTAGE = 'Percentage'
}

const DEFAULT_CAPACITY_UNITS = new Map<EChartFormat, string>([
  [EChartFormat.HOURS, "1h"],
  [EChartFormat.DAYS,  "1d"],
  [EChartFormat.MANDAYS, "8h"],
  [EChartFormat.PERCENTAGE, "1d"],
])

interface IChartSeries {
    title: string
    data: number[]
}

function createChart(type: string, labels: string[], series: IChartSeries[]) {
    return `\`\`\`chart
type: ${type}
width: ${CHART_WIDTH}
labels: [${labels}]
series:
${series.map(s => {
        return `  - title: ${s.title}
    data: [${s.data}]`
    }).join('\n')}
\`\`\``
}


export async function getWorklogPerDay(projectKeyOrId: string, startDate: string, endDate: string = 'now()', options: { authors?: string[] } = {}) {
    const worklogs = await API.macro.getWorkLogByDates(projectKeyOrId, startDate, endDate)
    const opts = {
      authors: options.authors || null
    }

    const labels = []
    const emptySeries: ISeries = {}
    const intervalStart = moment(startDate)
    const intervalEnd = moment(endDate)
    for (const i = intervalStart.clone(); i < intervalEnd; i.add(1, 'd')) {
        labels.push(i.format('YYYY-MM-DD'))
        emptySeries[i.format('YYYY-MM-DD')] = 0
    }
    const usersSeries: IMultiSeries = {}
    for (const worklog of worklogs) {
        const author = worklog.author.emailAddress
        if ( (opts.authors == null) || ((opts.authors != null) && (opts.authors.includes(author))) ) {
          if (!usersSeries[author]) {
              usersSeries[author] = Object.assign({}, emptySeries)
          }
          const worklogStart = moment(worklog.started).format('YYYY-MM-DD')
          if (worklogStart in usersSeries[author]) {
              usersSeries[author][worklogStart] += worklog.timeSpentSeconds
          }
        }
    }

    return createChart('line',
        labels,
        Object.entries(usersSeries).map(u => {
            return {
                title: u[0],
                data: Object.values(u[1])
            } as IChartSeries
        }))
}

// Capacity is in days, or Mandays
export async function getWorklogPerUser(projectKeyOrId: string, startDate: string, endDate: string = 'now()', options: { format?: EChartFormat, capacity?: ISeries, capacityUnit?: string, maxCapacity?: number } = {}) {
    const format = options.format || EChartFormat.PERCENTAGE
    const opt = {
        format: format,
        capacity: options.capacity || null,
        capacityUnit: options.capacityUnit || DEFAULT_CAPACITY_UNITS.get(format),
        maxCapacity: options.maxCapacity || moment.duration(moment(endDate).diff(startDate)).asDays()
    }
    const series = await API.macro.getWorkLogSeriesByUser(projectKeyOrId, startDate, endDate)
    switch (opt.format) {
        case EChartFormat.HOURS:
        case EChartFormat.MANDAYS:
        case EChartFormat.DAYS:
            for (const a in series) {
                series[a] = series[a] / ms(opt.capacityUnit)
            }
            break
        case EChartFormat.PERCENTAGE:
          let capacityUnitMs = ms(opt.capacityUnit)
          for (const author in series) {
              if (opt.capacity) {
                  if (author in opt.capacity) {
                      series[author] = series[author] / opt.capacity[author] / capacityUnitMs * 100
                  } else {
                      delete series[author]
                  }
              } else {
                  series[author] = series[author] / opt.maxCapacity / capacityUnitMs * 100
              }
          }
          break
          default:
            throw new Error('Invalid chart format')
    }

    return createChart('bar',
        Object.keys(series),
        [{
            title: `Time logged ${opt.format}`,
            data: Object.values(series)
        }])
}
