/**
 * Identity's public surface — deliberately empty.
 *
 * Every module has one of these and it is the only file another module may import from.
 * Everything else in the directory is internal: `IdentityService` is not exported by the Nest
 * module, and nothing here re-exports it, so there is no way to reach past the seam into how
 * sign-in works.
 *
 * That identity offers nothing is not an oversight. What other modules need from it — who the
 * caller is — arrives through `platform/auth`'s `SessionAuthority`, which identity binds
 * itself to. A module asks the platform who is asking; it does not ask identity. That is what
 * lets the application boot with identity absent, and what stops forty modules acquiring a
 * dependency on the one module they would all otherwise name.
 *
 * The empty export is the declaration. A module without this file has no public surface at
 * all, and the conformance pack says so by name.
 */
export {};
