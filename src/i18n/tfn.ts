// The translate function's shape, on its own so server code (functions/) can name it
// without importing React.

/** Interpolates {name} placeholders so counts/names stay out of the phrase table. */
export type TFn = (thai: string, vars?: Record<string, string | number>) => string
