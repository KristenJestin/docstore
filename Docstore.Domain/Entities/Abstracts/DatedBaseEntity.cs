namespace Docstore.Domain.Entities.Abstracts
{
    public abstract class DatedBaseEntity : BaseEntity
    {
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
    }
}
