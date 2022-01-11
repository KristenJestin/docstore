namespace Docstore.Domain.Entities
{
    public abstract class DatedBaseEntity : BaseEntity
    {
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }
}
