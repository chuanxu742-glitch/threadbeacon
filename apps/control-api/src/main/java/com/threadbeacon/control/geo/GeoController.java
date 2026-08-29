package com.threadbeacon.control.geo;

import com.threadbeacon.control.common.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/internal/geo-acquisition")
public class GeoController {
    private final GeoService geo;private final CurrentUser user;
    public GeoController(GeoService geo,CurrentUser user){this.geo=geo;this.user=user;}
    @GetMapping("/capabilities") ResponseEntity<Map<String,Object>> capabilities(){var body=geo.capabilities();return ResponseEntity.status(Boolean.TRUE.equals(body.get("ready"))?HttpStatus.OK:HttpStatus.SERVICE_UNAVAILABLE).body(body);}
    @PostMapping("/executions") ResponseEntity<Map<String,Object>> submit(@RequestBody Map<String,Object> body){var result=geo.submit(user.ownerId(),body);return ResponseEntity.status(result.created()?HttpStatus.ACCEPTED:HttpStatus.OK).body(Map.of("created",result.created(),"execution",result.execution()));}
    @GetMapping("/executions/{id}") Map<String,Object> get(@PathVariable String id){return Map.of("execution",geo.get(user.ownerId(),id));}
    @PostMapping("/executions/{id}/cancel") Map<String,Object> cancel(@PathVariable String id){return Map.of("execution",geo.cancel(user.ownerId(),id));}
}
