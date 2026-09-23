/** What a screen that shows month-on-month figures needs behind it. */
export const MONTH_DAYS = 30

/**
 * What a screen that IS the history needs behind it.
 *
 * A week was enough for the screens people key on, and cutting the start-up window to a
 * week is what keeps the daily read quota in reach — but it also emptied the history
 * screen of everything older, and the owner went looking for August and found nothing
 * (23 Sep 2026: "ที่ฉันลงไปมันหายไปไหนหมด"). Nothing was ever lost; it simply was not
 * fetched. The history screens ask for a quarter, which is what anybody means by "the
 * history", and older still is one click away (LedgerWindowNotice).
 */
export const QUARTER_DAYS = 90
