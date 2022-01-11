namespace Docstore.Domain.Entities
{
    public class Document : DatedBaseEntity
    {
        public string? Name { get; set; }
        public string? Description { get; set; }


        #region relations
        public ICollection<DocumentFile> Files { get; set; } = new List<DocumentFile>();
        public ICollection<DocumentTag> Tags { get; set; } = new List<DocumentTag>();
        #endregion
    }
}
