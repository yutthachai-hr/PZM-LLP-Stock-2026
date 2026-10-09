/* R&D (Goose evaluation). The three C helpers integrity.goose binds with `extern fn`:
   IEEE-754 bits to a double (memcpy: the defined way in C), floor and isfinite from libm. */
#include <stdbool.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
static double pzm_f64_from_bits(uint64_t b) { double d; memcpy(&d, &b, sizeof d); return d; }
static double pzm_floor(double x) { return floor(x); }
static uint8_t pzm_is_finite(double x) { return isfinite(x) ? 1 : 0; }  /* Goose bool is uint8_t in C */
