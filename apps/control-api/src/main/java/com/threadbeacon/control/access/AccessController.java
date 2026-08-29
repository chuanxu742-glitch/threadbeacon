package com.threadbeacon.control.access;

import com.threadbeacon.control.common.ApiException;
import com.threadbeacon.control.common.CurrentUser;
import com.threadbeacon.control.platform.PlatformService;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;

import static com.threadbeacon.control.common.Values.*;

@RestController
@RequestMapping("/api/admin/access")
public class AccessController {
    private final JdbcTemplate jdbc;private final CurrentUser user;private final PlatformService platform;
    public AccessController(JdbcTemplate jdbc,CurrentUser user,PlatformService platform){this.jdbc=jdbc;this.user=user;this.platform=platform;}

    @GetMapping Map<String,Object> list(){user.requireRole("owner");var workspace=workspace();var members=jdbc.queryForList("SELECT m.id,m.user_id,m.role,m.created_at,p.email,p.display_name,'active' AS status FROM workspace_members m LEFT JOIN workspace_member_profiles p ON p.workspace_id=m.workspace_id AND p.user_id=m.user_id WHERE m.workspace_id=? ORDER BY m.created_at",workspace.get("id"));return Map.of("members",members,"currentRole",user.role(),"role",user.role());}
    @PostMapping Map<String,Object> invite(@RequestBody Map<String,Object> body){user.requireRole("owner");var email=text(body.get("email")).toLowerCase();var role=text(body.get("role"));if(!email.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")||!java.util.Set.of("editor","viewer").contains(role))throw new ApiException(HttpStatus.BAD_REQUEST,"邮箱或角色无效");var workspace=workspace();if(email.equalsIgnoreCase(user.email())||!jdbc.queryForList("SELECT 1 FROM workspace_member_profiles WHERE workspace_id=? AND lower(email)=? LIMIT 1",workspace.get("id"),email).isEmpty())throw new ApiException(HttpStatus.CONFLICT,"该邮箱已经是工作区成员");var token=UUID.randomUUID().toString().replace("-","")+UUID.randomUUID().toString().replace("-","");var invitationId=id();var timestamp=now();jdbc.update("INSERT INTO workspace_invitations(id,workspace_id,owner_id,email,role,token_hash,invited_by,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",invitationId,workspace.get("id"),user.ownerId(),email,role,hash(token),user.ownerId(),Instant.now().plus(7,ChronoUnit.DAYS).toString(),timestamp,timestamp);return Map.of("token",token,"inviteUrl","/invite?token="+token);}
    @PatchMapping Map<String,Object> update(@RequestBody Map<String,Object> body){user.requireRole("owner");var workspace=workspace();var memberId=text(body.get("id"));if("remove".equals(body.get("action"))){if(jdbc.update("DELETE FROM workspace_members WHERE id=? AND workspace_id=? AND role<>'owner'",memberId,workspace.get("id"))!=1)throw new ApiException(HttpStatus.NOT_FOUND,"成员不存在");}else{var role=text(body.get("role"));if(!java.util.Set.of("editor","viewer").contains(role)||jdbc.update("UPDATE workspace_members SET role=? WHERE id=? AND workspace_id=? AND role<>'owner'",role,memberId,workspace.get("id"))!=1)throw new ApiException(HttpStatus.BAD_REQUEST,"成员或角色无效");}return Map.of("ok",true);}
    private Map<String,Object> workspace(){platform.studio(user.ownerId());return jdbc.queryForMap("SELECT * FROM workspaces WHERE owner_id=?",user.ownerId());}
}
