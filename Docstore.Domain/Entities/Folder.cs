using Docstore.Domain.Entities.Abstracts;
using System.ComponentModel.DataAnnotations.Schema;

namespace Docstore.Domain.Entities
{
    public class Folder : UserOwnsBaseEntity
    {
        public string? Name { get; set; }
        public string? Description { get; set; }
        public string? Color { get; set; }


        #region extras
        [NotMapped] public int DocumentsCount { get; set; }
        [NotMapped] public long Size { get; set; }
        #endregion

        #region relations
        public ICollection<Document> Documents { get; set; } = new List<Document>();
        #endregion
    }
}
