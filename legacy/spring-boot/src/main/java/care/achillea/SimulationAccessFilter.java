package care.achillea;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Development integration credential plus bounded body, including chunked requests. */
@Component
class SimulationAccessFilter extends OncePerRequestFilter {

  private final boolean enabled;
  private final byte[] key;
  private final int limit;
  private final ObjectMapper json;

  SimulationAccessFilter(
    @Value("${app.demo-mode}") boolean demo,
    @Value("${app.simulation.enabled}") boolean enabled,
    @Value("${app.simulation.key}") String key,
    @Value("${app.simulation.max-bytes}") int limit,
    ObjectMapper json
  ) {
    this.enabled = enabled && demo;
    this.key = key.getBytes(StandardCharsets.UTF_8);
    this.limit = limit;
    this.json = json;
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest r) {
    return !r.getRequestURI().startsWith("/api/integrations/simulation/v1/");
  }

  private void error(HttpServletResponse response, int code, String message)
    throws IOException {
    response.setStatus(code);
    response.setContentType("application/json");
    json.writeValue(
      response.getOutputStream(),
      Map.of(
        "code",
        code,
        "message",
        message,
        "timestamp",
        Instant.now().toString(),
        "correlationId",
        UUID.randomUUID().toString()
      )
    );
  }

  @Override
  protected void doFilterInternal(
    HttpServletRequest request,
    HttpServletResponse response,
    FilterChain chain
  ) throws ServletException, IOException {
    if (!enabled) {
      error(response, 403, "External simulation integration is disabled");
      return;
    }
    String supplied = request.getHeader("X-Simulation-Key");
    if (
      supplied == null ||
      key.length < 24 ||
      !MessageDigest.isEqual(key, supplied.getBytes(StandardCharsets.UTF_8))
    ) {
      error(response, 401, "Valid simulation credential required");
      return;
    }
    if (request.getContentLengthLong() > limit) {
      error(response, 413, "Simulation request exceeds configured byte limit");
      return;
    }
    byte[] body = request.getInputStream().readNBytes(limit + 1);
    if (body.length > limit) {
      error(response, 413, "Simulation request exceeds configured byte limit");
      return;
    }
    HttpServletRequestWrapper wrapped = new HttpServletRequestWrapper(request) {
      @Override
      public ServletInputStream getInputStream() {
        ByteArrayInputStream bytes = new ByteArrayInputStream(body);
        return new ServletInputStream() {
          public int read() {
            return bytes.read();
          }

          public boolean isFinished() {
            return bytes.available() == 0;
          }

          public boolean isReady() {
            return true;
          }

          public void setReadListener(ReadListener listener) {
            throw new UnsupportedOperationException();
          }
        };
      }

      @Override
      public BufferedReader getReader() {
        return new BufferedReader(
          new InputStreamReader(getInputStream(), StandardCharsets.UTF_8)
        );
      }
    };
    chain.doFilter(wrapped, response);
  }
}
