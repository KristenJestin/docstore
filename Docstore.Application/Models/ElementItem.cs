using Docstore.Domain.Entities;

namespace Docstore.Application.Models
{
    public class ElementItem
    {
        public int Id { get; set; }
        public string? Name { get; set; }
        public string? Description { get; set; }
        public long Size { get; set; }
        public int ChildrensCount { get; set; }
        public DateTime LastUpdate { get; set; }
        public ElementItemType Type { get; set; }
    }

    public enum ElementItemType
    {
        Folder,
        Document
    }
}
