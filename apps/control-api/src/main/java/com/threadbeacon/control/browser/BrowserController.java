package com.threadbeacon.control.browser;

import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.node.NodeService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.core.io.InputStreamResource;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

import static com.threadbeacon.control.common.Values.object;
import static com.threadbeacon.control.common.Values.text;

@RestController
@RequestMapping("/api/browser")
public class BrowserController {
    private final BrowserService browser;private final NodeService nodes;private final CurrentUser user;
    public BrowserController(BrowserService browser,NodeService nodes,CurrentUser user){this.browser=browser;this.nodes=nodes;this.user=user;}
    @GetMapping Map<String,Object> list(){return browser.list(user.ownerId());}
    @PostMapping ResponseEntity<Map<String,Object>> create(@RequestBody Map<String,Object> body){return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of("session",browser.createSession(user.ownerId(),body)));}
    @PatchMapping("/sessions/{id}") Map<String,Object> close(@PathVariable String id){browser.close(user.ownerId(),id);return Map.of("ok",true);}
    @PostMapping("/sessions/{id}/actions") ResponseEntity<Map<String,Object>> action(@PathVariable String id,@RequestBody Map<String,Object> body){browser.queue(user.ownerId(),id,body);return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of("ok",true));}
    @GetMapping("/actions/{id}/screenshot") ResponseEntity<InputStreamResource> screenshot(@PathVariable String id){var screenshot=browser.screenshot(user.ownerId(),id);return ResponseEntity.ok().contentType(MediaType.parseMediaType(screenshot.contentType())).body(new InputStreamResource(screenshot.stream()));}
    @PostMapping("/worker/claim") Map<String,Object> claim(HttpServletRequest request,@RequestBody Map<String,Object> body){var node=nodes.authenticate(request,body);var response=new LinkedHashMap<String,Object>();response.put("action",browser.claim(node));return response;}
    @PostMapping("/worker/actions/{id}/complete") Map<String,Object> complete(HttpServletRequest request,@PathVariable String id,@RequestBody Map<String,Object> body){var node=nodes.authenticate(request,body);browser.complete(node,id,object(body.get("result")));return Map.of("ok",true);}
    @PostMapping("/worker/actions/{id}/fail") Map<String,Object> fail(HttpServletRequest request,@PathVariable String id,@RequestBody Map<String,Object> body){var node=nodes.authenticate(request,body);browser.fail(node,id,text(body.get("error")));return Map.of("ok",true);}
}
