package com.threadbeacon.control.workspace;

import org.springframework.http.HttpStatus;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/** Small opaque offset cursor for the first v2 projections. */
public final class V2Cursor {
    private V2Cursor() {}

    public static int offset(String cursor) {
        if (cursor == null || cursor.isBlank()) return 0;
        try {
            var decoded = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
            if (!decoded.startsWith("offset:")) throw new IllegalArgumentException();
            var value = Integer.parseInt(decoded.substring("offset:".length()));
            if (value < 0) throw new IllegalArgumentException();
            return value;
        } catch (Exception error) {
            throw new V2ApiException(HttpStatus.BAD_REQUEST, "INVALID_CURSOR", "分页 cursor 无效");
        }
    }

    public static String next(int offset) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                ("offset:" + offset).getBytes(StandardCharsets.UTF_8));
    }
}
