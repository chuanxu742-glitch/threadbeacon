package com.threadbeacon.control.node;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class NodeController {
    private final NodeService nodes;

    public NodeController(NodeService nodes) { this.nodes = nodes; }

    @PostMapping("/nodes")
    ResponseEntity<Map<String, Object>> register(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(nodes.register(request, body));
    }

    @GetMapping("/nodes")
    Map<String, Object> list() { return Map.of("nodes", nodes.list()); }

    @PostMapping("/worker/heartbeat")
    Map<String, Object> heartbeat(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        var node = nodes.authenticate(request, body);
        nodes.heartbeat(node, body);
        return Map.of("ok", true);
    }
}
