﻿namespace Docstore.Domain.Entities
{
    public class Document : DatedBaseEntity
    {
        public string? Name { get; set; }
        public string? Description { get; set; }
        public int? FolderId { get; set; }


        #region relations
        public Folder? Folder { get; set; }
        public ICollection<DocumentFile> Files { get; set; } = new List<DocumentFile>();
        public ICollection<DocumentTag> Tags { get; set; } = new List<DocumentTag>();
        #endregion
    }
}