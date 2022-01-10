namespace Docstore.App.Data
{
    public class Document : DatedBaseEntity
    {
        public string? Name { get; set; }
        public string? Description { get; set; }


        #region relations
        public ICollection<DocumentFile> Files { get; set; } = new List<DocumentFile>();
        #endregion
    }
}
