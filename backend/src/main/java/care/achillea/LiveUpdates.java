package care.achillea;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import jakarta.annotation.PreDestroy;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Server-Sent Events push for the UI: every committed save bumps a revision and subscribers get a
 * {@code change} event so they refresh immediately instead of waiting for the next poll.
 *
 * <p>Events carry only the revision number (no clinical data); clients re-read through the normal
 * API. Sends run on one background thread and bursts are coalesced into a single event, so writers
 * (synchronized CareService commands) never wait on a slow client.
 */
@Component
public class LiveUpdates {

  private static final long STREAM_TIMEOUT_MS = 30 * 60 * 1000L; // browsers reconnect automatically

  private final List<SseEmitter> clients = new CopyOnWriteArrayList<>();
  private final AtomicLong revision = new AtomicLong();
  private final AtomicBoolean pending = new AtomicBoolean();
  private final ExecutorService sender = Executors.newSingleThreadExecutor(r -> {
    Thread t = new Thread(r, "live-updates");
    t.setDaemon(true);
    return t;
  });

  public SseEmitter subscribe() {
    SseEmitter emitter = new SseEmitter(STREAM_TIMEOUT_MS);
    clients.add(emitter);
    emitter.onCompletion(() -> clients.remove(emitter));
    emitter.onTimeout(() -> clients.remove(emitter));
    emitter.onError(e -> clients.remove(emitter));
    // Tell the client it is connected and which revision it is at.
    sender.execute(() -> send(emitter, "ready", revision.get()));
    return emitter;
  }

  /** Called after a successful commit. Cheap and non-blocking. */
  public void changed() {
    revision.incrementAndGet();
    if (pending.compareAndSet(false, true)) sender.execute(() -> {
      pending.set(false);
      long current = revision.get();
      for (SseEmitter c : clients) send(c, "change", current);
    });
  }

  /** Keeps idle connections open through proxies and tunnels that drop silent streams. */
  @Scheduled(fixedDelay = 20_000)
  void heartbeat() {
    if (clients.isEmpty()) return;
    sender.execute(() -> {
      for (SseEmitter c : clients) {
        try {
          c.send(SseEmitter.event().comment("keep-alive"));
        } catch (IOException | IllegalStateException e) {
          drop(c);
        }
      }
    });
  }

  int subscribers() {
    return clients.size();
  }

  long revision() {
    return revision.get();
  }

  private void send(SseEmitter c, String name, long rev) {
    try {
      c.send(SseEmitter.event().name(name).data("{\"revision\":" + rev + "}", MediaType.APPLICATION_JSON));
    } catch (IOException | IllegalStateException e) {
      drop(c);
    }
  }

  private void drop(SseEmitter c) {
    clients.remove(c);
    try {
      c.complete();
    } catch (RuntimeException ignored) {
      // already closed
    }
  }

  @PreDestroy
  void shutdown() {
    sender.shutdownNow();
    clients.forEach(this::drop);
  }
}
