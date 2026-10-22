# Security

Sandbox Environment is a security boundary between a host page and untrusted artifact code.
Please report vulnerabilities privately via GitHub Security Advisories on this repository
(Security › Report a vulnerability), not in public issues.

Threat model (short): artifact code is untrusted; the host page and its API implementations
are trusted. The library must prevent artifacts from reading host DOM, storage, cookies or
tokens; from calling host functions that were not exposed; from bypassing host middleware;
and from reaching the network beyond the effective allowlist. Out of scope: denial of service
by an artifact against its own frame, and anything the host's own API chooses to allow.
