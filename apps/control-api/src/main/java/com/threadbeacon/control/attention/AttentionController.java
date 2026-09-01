package com.threadbeacon.control.attention;

import com.threadbeacon.control.common.CurrentUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** v2 Attention inbox; source object state remains authoritative. */
@RestController
@RequestMapping("/api/v2/attention")
public class AttentionController {
    private final AttentionService attention;
    private final CurrentUser user;

    public AttentionController(AttentionService attention, CurrentUser user) {
        this.attention = attention;
        this.user = user;
    }

    @GetMapping
    public Map<String, Object> list(@RequestParam(required = false) String projectId,
                                    @RequestParam(defaultValue = "open") String status,
                                    @RequestParam(defaultValue = "50") int limit,
                                    @RequestParam(defaultValue = "") String cursor) {
        user.requireScope("records:read");
        return attention.list(user.ownerId(), projectId, status, limit, cursor);
    }

    @GetMapping("/{itemId}")
    public Map<String, Object> item(@PathVariable String itemId) {
        user.requireScope("records:read");
        return Map.of("item", attention.item(user.ownerId(), itemId));
    }

    @PatchMapping("/{itemId}")
    public Map<String, Object> update(@PathVariable String itemId,
                                      @RequestBody Map<String, Object> body) {
        user.requireScope("records:read");
        user.requireRole("editor");
        var item = attention.update(user.ownerId(), user.userId(), itemId, body);
        return Map.of("item", item, "attention", item);
    }
}
