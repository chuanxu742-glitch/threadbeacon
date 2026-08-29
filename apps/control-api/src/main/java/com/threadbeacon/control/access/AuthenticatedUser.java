package com.threadbeacon.control.access;

import java.util.Set;

/** Request identity produced by PAT authentication. Basic/OIDC identities use the local account fallback. */
public record AuthenticatedUser(
        String ownerId,
        String subject,
        String email,
        String displayName,
        String role,
        Set<String> scopes,
        String credentialId
) {}
