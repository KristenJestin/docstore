namespace Docstore.Domain.Entities.Abstracts
{
    public abstract class BaseEntity : DatedBaseEntity
    {
        public int Id { get; set; }
    }
}
