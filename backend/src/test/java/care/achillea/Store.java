package care.achillea;

/** Test-only view of the whole aggregate as JSON (the production store is relational). */
class Store {
  public String id;
  public String payload;

  Store(String id, String payload) {
    this.id = id;
    this.payload = payload;
  }
}
