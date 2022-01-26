using Docstore.App.Models.Forms;
using Docstore.Application.Models.DTO;
using Docstore.Domain.Entities;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

namespace Docstore.App.Models
{
    public class DocumentCreateViewModel
    {
        public DocumentCreateForm Form { get; set; }
        public FolderCreateForm FormFolder { get; set; }

        public Folder? Folder { get; set; }
        public IEnumerable<GetDocumentFileDto> Files { get; set; }


        public DocumentCreateViewModel(int? folderId = null, Folder? folder = null, IEnumerable<GetDocumentFileDto> files = null)
        {
            Form = GetDefaultFormValues(folderId);
            FormFolder = GetDefaultFolderFormValues();

            Folder = folder;
            Files = files ?? new List<GetDocumentFileDto>();
        }


        #region methods
        public string FilesToJson()
            => JsonConvert.SerializeObject(Files, Formatting.None, new JsonSerializerSettings { ContractResolver = new CamelCasePropertyNamesContractResolver() });
        #endregion

        #region statics
        public static DocumentCreateForm GetDefaultFormValues(int? folderId = null) => new() { FolderId = folderId };
        public static FolderCreateForm GetDefaultFolderFormValues() => new();
        #endregion
    }
}
