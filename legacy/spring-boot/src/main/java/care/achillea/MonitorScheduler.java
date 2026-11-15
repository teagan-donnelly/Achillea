package care.achillea;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(
  name = { "app.demo-mode", "app.monitor.enabled" },
  havingValue = "true",
  matchIfMissing = true
)
public class MonitorScheduler {

  private static final Logger log = LoggerFactory.getLogger(
    MonitorScheduler.class
  );
  private final CareService service;

  public MonitorScheduler(CareService service) {
    this.service = service;
  }

  @Scheduled(
    fixedDelayString = "${app.monitor.cadence-ms:15000}",
    initialDelayString = "${app.monitor.initial-delay-ms:15000}"
  )
  public void receive() {
    try {
      service.monitorTick();
    } catch (RuntimeException e) {
      log.error(
        "Synthetic monitor tick failed ({}); retrying next cadence",
        e.getClass().getSimpleName()
      );
    }
  }
}
