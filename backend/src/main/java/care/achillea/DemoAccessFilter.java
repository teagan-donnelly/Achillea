package care.achillea;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.Clock;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Shared educational-demo access. Not hospital identity or clinical authorization. */
@Component
@Order(-100)
class DemoAccessFilter extends OncePerRequestFilter {

  static final String COOKIE = "achillea_session";
  private final boolean enabled, secure;
  private final byte[] password, signingKey;
  private final ObjectMapper json;
  private final Clock clock;
  private final Map<String, long[]> attempts = new LinkedHashMap<>();

  DemoAccessFilter(
    @Value("${app.access.enabled}") boolean enabled,
    @Value("${app.access.password}") String password,
    @Value("${app.access.signing-key}") String key,
    @Value("${app.access.secure-cookie}") boolean secure,
    ObjectMapper json,
    Clock clock
  ) {
    if (
      enabled &&
      (password.length() < 24 || key.length() < 32 || password.equals(key))
    ) throw new IllegalStateException(
      "Demo access requires a unique APP_ACCESS_PASSWORD (24+ characters) and separate APP_SESSION_SECRET (32+ characters)"
    );
    this.enabled = enabled;
    this.secure = secure;
    this.password = password.getBytes(StandardCharsets.UTF_8);
    this.signingKey = key.getBytes(StandardCharsets.UTF_8);
    this.json = json;
    this.clock = clock;
  }

  private String sign(String payload) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(signingKey, "HmacSHA256"));
      return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("Session signing unavailable", e);
    }
  }

  private boolean authenticated(HttpServletRequest request) {
    if (!enabled) return true;
    for (Cookie cookie : request.getCookies() == null
      ? new Cookie[0]
      : request.getCookies()) {
      if (!COOKIE.equals(cookie.getName())) continue;
      try {
        String[] parts = cookie.getValue().split("\\.", -1);
        if (parts.length != 2 || parts[0].length() > 150) return false;
        long expires = Long.parseLong(parts[0].split(":", -1)[0]);
        return (
          expires > clock.instant().getEpochSecond() &&
          expires <= clock.instant().plusSeconds(28800).getEpochSecond() &&
          MessageDigest.isEqual(
            sign(parts[0]).getBytes(StandardCharsets.US_ASCII),
            parts[1].getBytes(StandardCharsets.US_ASCII)
          )
        );
      } catch (IllegalArgumentException e) {
        return false;
      }
    }
    return false;
  }

  private synchronized boolean rateLimited(String address) {
    long now = clock.instant().getEpochSecond();
    attempts.entrySet().removeIf(entry -> entry.getValue()[0] < now - 300);
    if (attempts.size() >= 2000 && !attempts.containsKey(address)) return true;
    long[] entry = attempts.computeIfAbsent(address, ignored -> new long[] {
      now,
      0,
    });
    return ++entry[1] > 8;
  }

  private void cookie(HttpServletResponse response, String token, long age) {
    response.addHeader(
      "Set-Cookie",
      ResponseCookie.from(COOKIE, token)
        .httpOnly(true)
        .secure(secure)
        .sameSite("Strict")
        .path("/api")
        .maxAge(age)
        .build()
        .toString()
    );
  }

  private void reply(HttpServletResponse response, int status, Object body)
    throws IOException {
    response.setStatus(status);
    response.setContentType("application/json");
    json.writeValue(response.getOutputStream(), body);
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    return !request.getRequestURI().startsWith("/api");
  }

  @Override
  protected void doFilterInternal(
    HttpServletRequest request,
    HttpServletResponse response,
    FilterChain chain
  ) throws ServletException, IOException {
    response.setHeader("Cache-Control", "private, no-store");
    String path = request.getRequestURI(),
      method = request.getMethod();
    // These endpoints have their own independent simulator credential and body limits.
    if (
      path.startsWith("/api/integrations/simulation/v1/") ||
      path.equals("/api/health")
    ) {
      chain.doFilter(request, response);
      return;
    }
    if (
      enabled &&
      !Set.of("GET", "HEAD", "OPTIONS").contains(method) &&
      "cross-site".equals(request.getHeader("Sec-Fetch-Site"))
    ) {
      reply(
        response,
        403,
        Map.of("message", "Cross-site writes are not allowed")
      );
      return;
    }
    if (path.equals("/api/session")) {
      if (method.equals("GET")) {
        reply(
          response,
          200,
          Map.of("required", enabled, "authenticated", authenticated(request))
        );
        return;
      }
      if (method.equals("DELETE")) {
        cookie(response, "", 0);
        reply(response, 200, Map.of("authenticated", false));
        return;
      }
      if (method.equals("POST")) {
        if (!enabled) {
          reply(response, 200, Map.of("authenticated", true));
          return;
        }
        if (
          !Objects.toString(request.getContentType(), "")
            .toLowerCase(Locale.ROOT)
            .startsWith("application/json")
        ) {
          reply(response, 415, Map.of("message", "JSON credentials required"));
          return;
        }
        if (rateLimited(request.getRemoteAddr())) {
          reply(
            response,
            429,
            Map.of("message", "Too many login attempts; wait five minutes")
          );
          return;
        }
        byte[] bytes = request.getInputStream().readNBytes(4097);
        if (bytes.length > 4096) {
          reply(response, 413, Map.of("message", "Login request too large"));
          return;
        }
        String supplied;
        try {
          supplied = json.readTree(bytes).path("password").asText("");
        } catch (IOException | NullPointerException e) {
          reply(response, 400, Map.of("message", "Invalid login request"));
          return;
        }
        if (
          !MessageDigest.isEqual(
            password,
            supplied.getBytes(StandardCharsets.UTF_8)
          )
        ) {
          reply(
            response,
            401,
            Map.of("message", "Invalid demo access password")
          );
          return;
        }
        String payload =
          clock.instant().plusSeconds(28800).getEpochSecond() +
          ":" +
          UUID.randomUUID();
        cookie(response, payload + "." + sign(payload), 28800);
        reply(response, 200, Map.of("authenticated", true));
        return;
      }
      reply(response, 405, Map.of("message", "Unsupported session method"));
      return;
    }
    if (!authenticated(request)) {
      reply(
        response,
        401,
        Map.of("message", "Sign in to access the synthetic demo")
      );
      return;
    }
    chain.doFilter(request, response);
  }
}
