package care.achillea;

import static care.achillea.Model.State;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Test helper preserving the old single-document API so tests can read or rewrite a whole
 * snapshot. Reads and writes go through {@link RelationalStore}, i.e. the real tables.
 */
@Component
class StoreRepository {

  private final RelationalStore store;
  private final ObjectMapper json;

  StoreRepository(RelationalStore store, ObjectMapper json) {
    this.store = store;
    this.json = json;
  }

  Optional<Store> findById(String id) {
    if (!"demo".equals(id)) return Optional.empty();
    return store.load().map(s -> {
      try {
        return new Store(id, json.writeValueAsString(s));
      } catch (Exception e) {
        throw new IllegalStateException(e);
      }
    });
  }

  Store saveAndFlush(Store row) {
    try {
      store.save(json.readValue(row.payload, State.class));
      return row;
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }
}
