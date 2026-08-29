package com.threadbeacon.control.access;

import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.common.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.Map;

import static com.threadbeacon.control.common.Values.*;

@Controller
@ResponseBody
@RequestMapping("/api/access")
public class WorkspaceAccessController {
    private final JdbcTemplate jdbc;private final TransactionTemplate transactions;private final CurrentUser user;
    public WorkspaceAccessController(JdbcTemplate jdbc,TransactionTemplate transactions,CurrentUser user){this.jdbc=jdbc;this.transactions=transactions;this.user=user;}

    @GetMapping("/workspaces") Map<String,Object> workspaces(){return Map.of("workspaces",jdbc.queryForList("SELECT w.id,w.owner_id,w.name,m.role,m.created_at FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=? ORDER BY m.created_at",user.userId()));}

    @PostMapping("/invitations/accept") Map<String,Object> accept(@RequestBody Map<String,Object> body){
        var token=text(body.get("token"));if(token.isBlank())throw new ApiException(HttpStatus.BAD_REQUEST,"邀请 token 不能为空");
        var rows=jdbc.queryForList("SELECT * FROM workspace_invitations WHERE token_hash=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?",hash(token),Instant.now().toString());
        if(rows.isEmpty())throw new ApiException(HttpStatus.NOT_FOUND,"邀请不存在、已使用或已过期");var invitation=rows.get(0);
        if(user.email().isBlank()||!user.email().equalsIgnoreCase(text(invitation.get("email"))))throw new ApiException(HttpStatus.FORBIDDEN,"当前登录邮箱与邀请邮箱不一致");
        var timestamp=now();transactions.executeWithoutResult(status->{
            var changed=jdbc.update("UPDATE workspace_invitations SET accepted_at=?,accepted_by=?,updated_at=? WHERE id=? AND accepted_at IS NULL AND revoked_at IS NULL",timestamp,user.userId(),timestamp,invitation.get("id"));
            if(changed!=1)throw new ApiException(HttpStatus.CONFLICT,"邀请已被其他请求使用");
            jdbc.update("INSERT INTO workspace_members(id,workspace_id,user_id,role,created_at) VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role",id(),invitation.get("workspace_id"),user.userId(),invitation.get("role"),timestamp);
            jdbc.update("INSERT INTO workspace_member_profiles(id,workspace_id,user_id,email,display_name,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,updated_at=excluded.updated_at",id(),invitation.get("workspace_id"),user.userId(),user.email(),user.displayName(),timestamp);
        });
        return Map.of("ok",true,"workspaceId",invitation.get("workspace_id"),"role",invitation.get("role"));
    }
}
