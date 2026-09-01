package com.threadbeacon.control.workspace;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class V2CursorTest {
    @Test
    void cursorRoundTripsAnOffsetWithoutExposingItsEncoding() {
        var cursor = V2Cursor.next(42);
        assertThat(cursor).doesNotContain("offset:");
        assertThat(V2Cursor.offset(cursor)).isEqualTo(42);
    }

    @Test
    void malformedCursorIsActionable() {
        assertThatThrownBy(() -> V2Cursor.offset("not-a-cursor"))
                .isInstanceOf(V2ApiException.class)
                .hasMessage("分页 cursor 无效");
    }
}
