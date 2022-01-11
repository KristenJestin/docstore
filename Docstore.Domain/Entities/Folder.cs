namespace Docstore.Domain.Entities
{
    public class Folder : DatedBaseEntity
    {
        public string? Name { get; set; }
        public string? Description { get; set; }
        public string? Color { get; set; }


        #region relations
        public ICollection<Document> Documents { get; set; } = new List<Document>();
        #endregion
    }
}
