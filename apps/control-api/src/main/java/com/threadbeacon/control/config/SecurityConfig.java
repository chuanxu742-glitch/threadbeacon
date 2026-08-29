package com.threadbeacon.control.config;

import com.threadbeacon.control.access.PatAuthenticationFilter;
import com.threadbeacon.control.common.CurrentUser;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.www.BasicAuthenticationFilter;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.core.authority.mapping.GrantedAuthoritiesMapper;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.authorization.AuthorizationDecision;

import java.util.ArrayList;

@Configuration
public class SecurityConfig {
    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    @Bean
    UserDetailsService users(ThreadBeaconProperties properties, PasswordEncoder encoder) {
        var auth = properties.auth();
        if (!auth.localEnabled()) return new InMemoryUserDetailsManager();
        return new InMemoryUserDetailsManager(User.withUsername(auth.username())
                .password(encoder.encode(auth.password()))
                .roles("OWNER")
                .build());
    }

    @Bean
    GrantedAuthoritiesMapper oidcAuthorities() {
        return authorities -> {
            var mapped = new ArrayList<GrantedAuthority>();
            mapped.addAll(authorities);
            mapped.add(new SimpleGrantedAuthority("ROLE_VIEWER"));
            return mapped;
        };
    }

    @Bean
    SecurityFilterChain security(HttpSecurity http, PatAuthenticationFilter pat,
                                 ObjectProvider<ClientRegistrationRepository> registrations,
                                 GrantedAuthoritiesMapper oidcAuthorities, CurrentUser currentUser) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/api/health", "/api/auth/methods", "/actuator/health/**", "/api/worker/**", "/api/browser/worker/**", "/api/integrations/webhooks/*").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/nodes").permitAll()
                        .requestMatchers("/api/admin/**", "/api/integrations/tokens/**")
                        .access((authentication, context) -> new AuthorizationDecision(
                                authentication.get().isAuthenticated() && rank(currentUser.role()) >= 3))
                        .requestMatchers("/api/access/invitations/accept").authenticated()
                        .requestMatchers("/api/mcp").authenticated()
                        .requestMatchers(HttpMethod.GET, "/api/**", "/actuator/info", "/actuator/metrics/**", "/actuator/prometheus").authenticated()
                        .requestMatchers("/api/**").access((authentication, context) -> new AuthorizationDecision(
                                authentication.get().isAuthenticated() && rank(currentUser.role()) >= 2))
                        .anyRequest().authenticated())
                .httpBasic(basic -> basic.authenticationEntryPoint((request, response, error) -> {
                    response.setStatus(401);
                    response.setContentType("application/json;charset=UTF-8");
                    response.getWriter().write("{\"error\":\"需要登录或登录已失效\"}");
                }))
                .logout(logout -> logout.logoutSuccessHandler((request, response, authentication) -> response.setStatus(204)))
                .addFilterBefore(pat, BasicAuthenticationFilter.class)
                .headers(headers -> headers.contentSecurityPolicy(csp -> csp.policyDirectives("default-src 'none'; frame-ancestors 'none'")));
        if (registrations.getIfAvailable() != null) {
            http.oauth2Login(login -> login.userInfoEndpoint(info -> info.userAuthoritiesMapper(oidcAuthorities)));
        }
        return http.build();
    }

    private static int rank(String role) {
        return switch (role) { case "owner" -> 3; case "editor" -> 2; default -> 1; };
    }
}
