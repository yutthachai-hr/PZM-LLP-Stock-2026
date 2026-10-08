PZM rulebook corpus for Reflex's modelless lane (RIIR_REFLEX_CORPUS=<this dir>).
One directory per Ask PZM intent; each .md is one document. Non-.md files (this one) are ignored.
Routing only: the answer to every intent comes from the deterministic read layer, never from here.
write_request exists so requests to CHANGE data are recognised and refused (Ask PZM is read-only).
