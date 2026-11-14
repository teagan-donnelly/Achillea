package care.achillea;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Legacy fixture adapter for regression tests ONLY. Not packaged or used at runtime. */
@Component
class StoreRepository {

  final RelationalStore relational;
  final ObjectMapper json;

  StoreRepository(RelationalStore r, ObjectMapper json) {
    this.relational = r;
    this.json = json;
  }

  @Transactional(readOnly = true)
  public Optional<Store> findById(String id) {
    try {
      if (
        relational
          .jdbc()
          .queryForObject("select count(*) from patients", Long.class) == 0
      ) return Optional.empty();
      return Optional.of(
        new Store(
          json.writeValueAsString(relational.load(null, null, true, null))
        )
      );
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  @Transactional
  public Store saveAndFlush(Store row) {
    try {
      Model.State state = json.readValue(row.payload, Model.State.class);
      new MonitorSimulation().ensureDevices(
        state,
        state.serverTime == null ? java.time.Instant.now() : state.serverTime
      );
      relational.replace(state);
      return row;
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }
}

class Store {

  public String payload;

  Store(String payload) {
    this.payload = payload;
  }
}
