using System.ComponentModel.DataAnnotations.Schema;

namespace Docstore.Domain.Entities
{
    public class Document : DatedBaseEntity
    {
        public string? Name { get; set; }
        public string? Description { get; set; }
        public int? FolderId { get; set; }

        public DateTime? ReceivedAt { get; set; }
        public DateTime? EndsAt { get; set; }


        #region extras
        [NotMapped] public int FilesCount { get; set; }
        [NotMapped] public long Size { get; set; }
        #endregion

        #region relations
        public Folder? Folder { get; set; }
        public ICollection<DocumentFile> Files { get; set; } = new List<DocumentFile>();
        public ICollection<DocumentTag> Tags { get; set; } = new List<DocumentTag>();
        #endregion
    }
}
