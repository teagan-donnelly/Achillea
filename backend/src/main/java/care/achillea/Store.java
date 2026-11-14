package care.achillea;
import jakarta.persistence.*;
import org.springframework.data.jpa.repository.JpaRepository;
@Entity
class Store {
 @Id public String id;
 @Lob public String payload;
 @Version public Long version;
 public Store() {} public Store(String id,String payload) {this.id=id;this.payload=payload;}
}
interface StoreRepository extends JpaRepository<Store,String> {}
