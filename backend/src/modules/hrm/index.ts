/**
 * The shape stub's public surface — empty, and the more interesting empty of the two.
 *
 * Identity offers nothing because what it knows reaches other modules through a platform
 * seam. Hrm offers nothing because nobody has asked. An employee is hrm's own record, pay is
 * restricted beyond company scope, and a pay run is immutable; there is no read another
 * module has a reason for that would not be better served by an event.
 *
 * When one does — an accounting module wanting `hrm.pay-run.calculated` — the answer is an
 * event it declares in the manifest, not an export here. This file exists so that the
 * decision has a place to be made explicitly rather than by whoever writes the first import.
 */
export {};
