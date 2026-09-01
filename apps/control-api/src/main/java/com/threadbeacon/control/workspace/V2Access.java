package com.threadbeacon.control.workspace;

import com.threadbeacon.control.common.CurrentUser;
import org.springframework.http.HttpStatus;

import java.util.Set;

/** Scope aliases retained for PATs issued before the v2 resource names existed. */
public final class V2Access {
    private V2Access() {}

    public static void projectRead(CurrentUser user) { require(user, "projects:read", "records:read", "runs:read"); }
    public static void projectWrite(CurrentUser user) { require(user, "projects:write", "workflows:run"); }
    public static void sourceRead(CurrentUser user) { require(user, "sources:read", "projects:read", "records:read", "runs:read"); }
    public static void sourceWrite(CurrentUser user) { require(user, "sources:write", "projects:write", "workflows:run"); }
    public static void workflowRead(CurrentUser user) { require(user, "workflows:read", "workflows:run", "runs:read"); }
    public static void workflowWrite(CurrentUser user) { require(user, "workflows:write", "workflows:run"); }
    public static void runRead(CurrentUser user) { require(user, "runs:read"); }
    public static void runWrite(CurrentUser user) { require(user, "runs:write", "workflows:run"); }

    public static void require(CurrentUser user, String... accepted) {
        Set<String> scopes = user.scopes();
        if (scopes.contains("*") || java.util.Arrays.stream(accepted).anyMatch(scopes::contains)) return;
        throw new V2ApiException(HttpStatus.FORBIDDEN, "MISSING_SCOPE",
                "当前 API Token 缺少所需 scope", java.util.Map.of("requiredAny", java.util.List.of(accepted)));
    }
}
