package com.threadbeacon.control.schedule;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ScheduleServiceTest {
    @Test
    void acceptsDocumentedFiveFieldCronExpressions() {
        assertDoesNotThrow(() -> ScheduleService.parseCron("*/15 * * * *"));
    }

    @Test
    void keepsSpringSixFieldCronCompatibility() {
        assertDoesNotThrow(() -> ScheduleService.parseCron("0 */15 * * * *"));
    }

    @Test
    void rejectsInvalidCronExpressions() {
        assertThrows(IllegalArgumentException.class, () -> ScheduleService.parseCron("not a cron"));
    }
}
