# 0004 · Pure protocol package, not a shared runtime core

Status: Accepted

## Decision

`promptpile-protocol` is the dependency-free executable projection of normative contracts and canonical fixtures shared by independent packages. Its public API is limited to pure data types, parsers, formatters, comparators, and published schemas with explicit domain versions.

It is not `promptpile-core`. Filesystem access, path identity, environment/configuration, process execution, locks, allocation, atomic publication, model clients, orchestration, recovery, and other lifecycle policy remain with their runtime owner.

## Admission rule

A new export must have a normative contract, pure representation, conformance fixture, and genuine cross-package interoperability value. Anything requiring runtime observation or lifecycle ownership is rejected. Experimental domains are not admitted merely because their data resembles a protocol.

## Consequences

The v1 package is CommonJS-only, has zero runtime dependencies, exposes domain subpaths, and treats changes to v1 recognition, ordering, canonical spelling, public shapes, or schemas as breaking changes. Archive, fingerprint encoding, and React agent events remain outside v1 until their separate maturity gates are met.
