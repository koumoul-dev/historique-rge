// en-CA renders dates as YYYY-MM-DD, which is what the history dataset stores
const parisDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })

export const today = (now: Date = new Date()): string => parisDay.format(now)

export const dayBefore = (day: string): string => {
  const [year, month, dayOfMonth] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, dayOfMonth - 1)).toISOString().slice(0, 10)
}
