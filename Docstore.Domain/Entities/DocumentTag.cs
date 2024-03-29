﻿using Docstore.Domain.Entities.Abstracts;

namespace Docstore.Domain.Entities
{
    public class DocumentTag : UserOwnsBaseEntity
    {
        public string? Name { get; set; }
        public string? Slug { get; set; }


        #region relations
        public ICollection<Document> Documents { get; set; } = new List<Document>();
        #endregion

        #region overrides
        public override bool Equals(object? obj)
        {
            if (obj == null)
                return false;

            var other = (DocumentTag)obj;
            return Slug == other.Slug;
        }

        public override int GetHashCode()
            => Slug!.GetHashCode();
        #endregion
    }
}
