using Docstore.Domain.Entities.Abstracts;
using System.ComponentModel.DataAnnotations.Schema;

namespace Docstore.Domain.Entities
{
    public class Document : UserOwnsBaseEntity
    {
        #region validations
        public static readonly string[] AllowedContentTypes = new[] { "image/jpeg", "image/jpg", "image/png", "application/pdf" };
        public const long MaxLength = 52428800;
        #endregion

        public string? Name { get; set; }
        public string? Description { get; set; }
        public int? FolderId { get; set; }

        [Column(TypeName = "date")]
        public DateTime? ReceivedAt { get; set; }
        [Column(TypeName = "date")]
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
