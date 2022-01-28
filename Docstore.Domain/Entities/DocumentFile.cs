using Docstore.Domain.Entities.Abstracts;

namespace Docstore.Domain.Entities
{
    public class DocumentFile : UserOwnsBaseEntity
    {
        public static readonly string[] StorePath = new[] { "uploads", "document-files" };

        public string? Name { get; set; }
        public string? OriginalName { get; set; }
        public string? Extension { get; set; }
        public long Size { get; set; }
        public string? StoredName { get; set; }
        public int? DocumentId { get; set; }
        public string? MimeType { get; set; }
        public int? Order { get; set; }


        #region relations
        public Document? Document { get; set; }
        #endregion

        #region methods
        public string GetFileName()
            => $"{Name}.{Extension}";
        #endregion
    }
}
